// ürün incelemeleri şeması mongodb

const mongoose = require('../helper/mongodb.js');

const ProductReviewSchema = new mongoose.Schema({
  productId: { type: String },
  userId: { type: String },
  rating: { type: Number },  // 1 ile 5 arasında puan değerlendirmesi
  title: { type: String },
  review: { type: String },
  createdAt: { type: Date, default: Date.now }
});


const ProductReview = mongoose.model('ProductReview', ProductReviewSchema);

module.exports = ProductReview;
