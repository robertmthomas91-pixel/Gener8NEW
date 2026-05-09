# Use Node 22 which supports TypeScript stripping
FROM node:22-slim

# Install build essentials for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Build the frontend
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the server with the experimental flag for TS stripping
# (Node 22 requires the flag, Node 23 does not)
CMD ["node", "--experimental-strip-types", "server.ts"]
