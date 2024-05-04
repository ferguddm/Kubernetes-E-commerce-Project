const mongoose = require('mongoose');

const mongoUri = 'mongodb://buse:123456@mongo-db-service:27017/ecommerceAppDb?directConnection=true&authSource=admin';

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000
}).then(() => {
  console.log('MongoDB bağlantısı başarıyla kuruldu');
}).catch(err => {
  console.error('MongoDB bağlantı hatası', err);
});

module.exports = mongoose;