FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci && npm ls html-to-image
COPY . .

EXPOSE 5175

CMD ["npm", "run", "dev", "--", "--port", "5175"]
