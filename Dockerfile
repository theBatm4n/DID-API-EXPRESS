FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci 

# Copy source code
COPY src ./src
COPY contracts ./contracts
COPY tsconfig.json ./

# Build TypeScript
RUN npm install -g typescript
RUN tsc

# Expose port 9000 (required by Alibaba FC)
EXPOSE 9000

# Start the app
CMD ["node", "dist/index.js"]