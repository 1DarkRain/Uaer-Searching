FROM nginx:alpine
COPY usernames.html /usr/share/nginx/html/index.html
EXPOSE 80
