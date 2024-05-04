const express = require('express');
const mysqldbConnection = require("./helper/mysql");

const app = express();
app.use(express.json()); 
const amqp = require('amqplib');


const rabbitMQUrl = 'amqp://user:password@rabbitmq-service:5672';
const exchangeName = 'orders_exchange';


async function consumeOrders() {
  try {
    const connection = await amqp.connect(rabbitMQUrl);
    const channel = await connection.createChannel();
    await channel.assertExchange(exchangeName, 'direct', { durable: true });
    const { queue } = await channel.assertQueue('', { exclusive: true });
    channel.bindQueue(queue, exchangeName, '');
    console.log('RabbitMQ kuyruğu dinleniyor');

    channel.consume(queue, async (msg) => {
      try {
        const order = JSON.parse(msg.content.toString());
        console.log(order);
        await saveOrderToDatabase(order); 
        console.log('Sipariş kaydedildi:', order);
        channel.ack(msg);
      } catch (err) {
        console.error('Sipariş kaydedilirken hata:', err);
        channel.nack(msg);
      }
    });
  } catch (err) {
    console.error('RabbitMQ kuyruğunu dinlerken hata:', err);
  }
}

async function saveOrderToDatabase(order) {
    await mysqldbConnection.query('INSERT INTO orders (user_id, product_id, quantity) VALUES (?, ?, ?)',
    [order.user_id, order.product_id, order.quantity]);
}


consumeOrders();