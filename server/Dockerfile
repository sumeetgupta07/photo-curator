# server/Dockerfile — v2.0 Stage 1
FROM node:20-slim

# better-sqlite3 needs build tools to compile its native binding
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src ./src
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "src/index.js"]
