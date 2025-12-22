FROM golang:1.21-alpine

WORKDIR /app

# Copiar arquivos de dependência
COPY go.mod go.sum ./
RUN go mod download

# Copiar código fonte
COPY src/ ./src/

# Build
RUN go build -o server src/main_dev.go

# Expor porta
EXPOSE 8080

# Rodar
CMD ["./server"]
