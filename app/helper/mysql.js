const mysql = require("mysql2/promise");

const connection = mysql.createPool({
  connectionLimit: 100,
  host: 'mysql-service', 
  user: "user",
  password: "password",
  database: "app",
  port: 3306
});


connection.getConnection((err, connection) => {
  if (err) {
    console.log("MySQL bağlantısı kurulurkan hata: ", err);
  } else {
    console.log("MySQL bağlantısı başarıyla kuruldu");
  }
});

module.exports = connection;