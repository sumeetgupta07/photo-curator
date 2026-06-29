# server/Dockerfile — v2.8
# PURPOSE: Backend container for Photo Curator. Adds ffmpeg (video frame
# extraction for thumbnails) and sharp (image resizing) on top of the
# v2.0 Stage 3 base.
FROM node:20-slim

# better-sqlite3 + sharp need build tools; ffmpeg for video thumbnails
RUN apt-get update && apt-get install -y python3 make g++ ffmpeg exiftool && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src ./src
RUN mkdir -p /app/data/thumbs/400 /app/data/thumbs/1600

EXPOSE 3001

CMD ["node", "src/index.js"]
