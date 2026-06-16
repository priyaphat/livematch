FROM golang:1.26-alpine AS build

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o /livematch-backend .

FROM alpine:3.22

WORKDIR /app
COPY --from=build /livematch-backend /usr/local/bin/livematch-backend
EXPOSE 8080
CMD ["livematch-backend"]

