FROM platformatic/node-caged:25-alpine
WORKDIR /app
COPY . .
RUN npm install sharp

ENV NODE_ENV=production
# node-caged alpine images ship no unprivileged user (unlike node:alpine),
# so create one to match the jobs' Dockerfiles.
RUN adduser -D -u 1000 node
USER node
EXPOSE 4000

CMD ["node", "--enable-source-maps", "dist/index.js"]
