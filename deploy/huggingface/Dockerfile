# Backend only (Express + Socket.IO). Hugging Face builds this image and runs it on port 7860.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# Change the number to force a fresh download of the latest code on the next rebuild.
ARG CACHE_BUST=1
RUN git clone --depth 1 https://github.com/gravityyyy99/youtube-watch-party.git /app
WORKDIR /app/server
RUN npm install --omit=dev
ENV PORT=7860
EXPOSE 7860
CMD ["node", "src/index.js"]
