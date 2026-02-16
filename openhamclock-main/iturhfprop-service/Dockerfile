FROM ubuntu:22.04

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js and utilities
RUN apt-get update && apt-get install -y \
    curl \
    tar \
    unzip \
    ca-certificates \
    findutils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create directory for ITURHFProp
WORKDIR /opt/iturhfprop

# Download individual binary files from v14.3 release (latest)
RUN curl -L -o ITURHFProp "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/ITURHFProp" \
    && curl -L -o libp533.so "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/libp533.so" \
    && curl -L -o libp372.so "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/releases/download/v14.3/libp372.so" \
    && chmod +x ITURHFProp

# Download GitHub source (more reliable than ITU)
RUN curl -L -o source.tar.gz "https://github.com/ITU-R-Study-Group-3/ITU-R-HF/archive/refs/tags/v14.3.tar.gz" \
    && tar -xzf source.tar.gz \
    && echo "=== Source structure ===" \
    && ls -la ITU-R-HF-14.3/ \
    && echo "=== P533 structure ===" \
    && ls -la ITU-R-HF-14.3/P533/ 2>/dev/null || echo "No P533 dir" \
    && echo "=== Finding ALL required files ===" \
    && find ITU-R-HF-14.3 -name "ionos*.bin" -type f \
    && find ITU-R-HF-14.3 -name "*.ant" -type f \
    && find ITU-R-HF-14.3 -name "COEFF01W.BIN" -type f

# Create Data directory and copy ALL required files explicitly
RUN mkdir -p /opt/iturhfprop/Data \
    && echo "=== Copying COEFF files ===" \
    && find ITU-R-HF-14.3 -name "COEFF*.BIN" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; \
    && find ITU-R-HF-14.3 -name "COEFF*.txt" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; \
    && echo "=== Copying ionospheric data ===" \
    && find ITU-R-HF-14.3 -name "ionos*.bin" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; \
    && echo "=== Copying antenna files ===" \
    && find ITU-R-HF-14.3 -name "*.ant" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; \
    && echo "=== Copying other data files ===" \
    && find ITU-R-HF-14.3 -name "P1239*.txt" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; 2>/dev/null || true \
    && find ITU-R-HF-14.3 -name "P372*.txt" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; 2>/dev/null || true \
    && find ITU-R-HF-14.3 -name "anthr.dat" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; 2>/dev/null || true \
    && find ITU-R-HF-14.3 -name "*.csv" -type f -exec cp -v {} /opt/iturhfprop/Data/ \; 2>/dev/null || true \
    && echo "=== Final Data directory ===" \
    && ls -la /opt/iturhfprop/Data/ \
    && echo "=== File count: $(ls -1 /opt/iturhfprop/Data/ | wc -l) ==="

# Cleanup
RUN rm -rf ITU-R-HF-14.3 source.tar.gz

# Set library path so ITURHFProp can find shared libs
ENV LD_LIBRARY_PATH=/opt/iturhfprop:$LD_LIBRARY_PATH

# Verify installation - show all files in Data
RUN echo "=== Binary files ===" && ls -la /opt/iturhfprop/*.so /opt/iturhfprop/ITURHFProp \
    && echo "=== Data directory contents ===" && ls -la /opt/iturhfprop/Data/ 2>/dev/null || echo "Data directory not found or empty"

# Set up the API service
WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY server.js ./

# Environment
ENV PORT=3000
ENV ITURHFPROP_PATH=/opt/iturhfprop/ITURHFProp
ENV ITURHFPROP_DATA=/opt/iturhfprop

EXPOSE 3000

CMD ["node", "server.js"]
