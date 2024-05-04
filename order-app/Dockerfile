FROM node:21.7.3-alpine3.19

WORKDIR /order-app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5002

CMD ["npm", "start"]