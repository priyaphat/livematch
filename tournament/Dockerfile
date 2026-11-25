FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5181
CMD ["npm", "run", "dev", "--", "--port", "5181", "--host", "0.0.0.0"]
