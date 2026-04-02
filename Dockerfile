FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    ffmpeg \
    unzip \
    imagemagick \
    libheif-examples \
    libde265-0 \
    libheif1 \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir rembg Pillow

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
