const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET_KEY = 'Ww33eqdc4e';
const redis = require('redis');
const mysqldbConnection = require("./helper/mysql");
const ProductReview = require('./schemas/productReview.js');
const amqp = require('amqplib');

const app = express();
app.use(express.json()); 

const redisClient = redis.createClient({
  url: 'redis://redis-service:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();
redisClient.on('event', function (event) {
  console.log('Redis çalıştı:', event);
});

const rabbitMQUrl = 'amqp://user:password@rabbitmq-service:5672';
const exchangeName = 'orders_exchange';


// kullanıcıdan alınan tokenı doğruluyoruz
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).send({ message: 'Token gerekli' });
  }
  redisClient.get(`blacklist_${token}`)
    .then(isBlacklisted => {
      if (isBlacklisted) {
        return res.status(401).send({ message: 'Token artık geçerli değil' });
      }
      jwt.verify(token, JWT_SECRET_KEY, (err, user) => {
        if (err) {
          const message = err.name === 'JsonWebTokenError' ? 'Geçersiz Token' : 
                          err.name === 'TokenExpiredError' ? 'Token süresi doldu' : 'Token doğrulanamadı';
          return res.status(403).send({ message });
        }
        req.user = user;
        next();
      });
    })
    .catch(err => {
      console.error('Token kontrolü hatası:', err);
      return res.status(500).send({ message: 'Token kontrolü sırasında bir hata oluştu' });
    });
}

// bu tokensiz görüntüleyebileceğimiz bi sayfa örneği
// anasayfa
app.get('/', async (req, res) => {
  res.send('Hoşgeldiniz ✨');
});



//giriş yap
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await mysqldbConnection.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (isMatch) {
        const currentToken = await redisClient.get(`user_${user.id}_token`);
        if (currentToken) {
            return res.status(409).send({ message: 'Giriş yapılmış aktif session var' });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET_KEY, { expiresIn: '1h' });
        await redisClient.set(`user_${user.id}_token`, token, { EX: 60 * 60 }); // 1 saat expire
        res.json({ message: 'Giriş başarılı', token });
    } else {
        res.status(401).send('Kullanıcı adı veya şifre yanlış');
    }
    } else {
      res.status(401).send('Kullanıcı bulunamadı');
    }
  } catch (err) {
    console.error('Giriş yaparken hata:', err);
    res.status(500).send('Server error');
  }
});


//kayıt ol
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!password) {
    return res.status(400).send('Şifre alanı boş bırakılamaz.');
  } else if(!email){
    return res.status(400).send('E-posta alanı boş bırakılamaz.');
  } else if(!username){
    return res.status(400).send('Kullanıcı adı alanı boş bırakılamaz.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [results] = await mysqldbConnection.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hashedPassword]);
    res.status(201).send('Kullanıcı kaydı oluşturuldu');
  } catch (err) {
    console.error('Kullanıcı kaydı yapılırken hata:', err);
    res.status(500).send('Server error');
  }
});


//çıkış yap
app.post('/signout', async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    await redisClient.set(`blacklist_${token}`, 'blacklisted', {
      EX: 60 * 60 * 24 // 1 gün expire token blacklist
    });
  }
  res.send('Çıkış yapıldı.');
});


// ürünleri listeleme
app.get('/products', authenticateToken, async (req, res) => {
  try {
    const cachedProducts = await redisClient.get('products_with_reviews');
    if (cachedProducts) {
      console.log("Redisten ürünler alındı");
      return res.status(200).json(JSON.parse(cachedProducts));
    }

    // rediste yoksa veritanından çekiyoruz ve redise kaydediyoruz
    console.log("Rediste ürün bulunamadı ve veri tabanından ürünler alındı");
    const products = await fetchProductsAndReviews();
    if (products && products.length > 0) {
      await redisClient.set('products_with_reviews', JSON.stringify(products), {
        EX: 60 * 60
      });
      return res.status(200).json(products);
    } else {
      return res.status(404).send('Ürün yok');
    }
  } catch (err) {
    console.error('Ürünler listelenirken hata oluştu:', err);
    res.status(500).send('Server error');
  }
});


// sipariş vermek için rabbitmq kuyruğuna ekle
app.post('/orders', authenticateToken, async (req, res) => {
  const { product_id, quantity } = req.body;
  const user_id = req.user.userId;
  try {
    const connection = await amqp.connect(rabbitMQUrl);
    const channel = await connection.createChannel();
    await channel.assertExchange(exchangeName, 'direct', { durable: true });
    const message = JSON.stringify({ user_id, product_id, quantity });
    channel.publish(exchangeName, '', Buffer.from(message), { persistent: true });
    console.log("Sipariş RabbitMQya gönderildi:", message);
    res.status(201).send('Siparişin alındı!');
  } catch (err) {
    console.error("RabbitMQya sipariş gönderilirken hata:", err);
    res.status(500).send('Server hatası');
  }
});

// kullanıcıya ait tüm siparişleri getirme 
app.get('/orders', authenticateToken, async (req, res) => {
  const user_id = req.user.userId;
  try {
    const [orders] = await mysqldbConnection.query('SELECT * FROM orders WHERE user_id = ?', [user_id]);
    res.status(200).json(orders);
  } catch (err) {
    console.error('Siparişlerin getirilirken hata oluştu:', err);
    res.status(500).send('Server hatası');
  }
});



//yeni bir ürün değerlendirmesi oluşturma
app.post('/product-reviews', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { productId, rating, title, review, createdAt } = req.body;
  try {
    const newProductReview = new ProductReview({ productId, userId, rating, title, review, createdAt });
    await newProductReview.save();
    res.status(201).send('Ürün değerlendirmeniz eklendi!');
  } catch (err) {
    console.error('Ürün değerlendirmesi eklenirken hata:', err);
    res.status(500).send('Server error');
  }
});



// MySQL ve MongoDB yi birlikte kullanarak ürünleri ve yorumları getir
async function fetchProductsAndReviews() {
  try {
    const [products] = await mysqldbConnection.query('SELECT * FROM products');
    if (products.length === 0) {
      return []; 
    }

    const productReviewsPromises = products.map(async product => {
      const reviews = await ProductReview.find({ productId: product.id });
      return { ...product, reviews };
    });

    const productsWithReviews = await Promise.all(productReviewsPromises);
    return productsWithReviews;
  } catch (err) {
    console.error('Veri tabanından ürünler ve yorumlar alınırken hata oluştu:', err);
    throw err;
  }
}



app.listen(5001, () => {
  console.log('Port 5001 üzerinde çalışıyor');
});