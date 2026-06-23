FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install

# Copy project files
COPY . .

EXPOSE 5173

# --host 0.0.0.0 makes Vite reachable from your iPhone on LAN
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
