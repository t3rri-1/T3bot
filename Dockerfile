FROM node:alpine3.19
ENV NODE_ENV=production

RUN apk add --no-cache git

RUN corepack enable

WORKDIR /app
RUN git clone https://github.com/t3rri-1/T3bot .

RUN yarn install --production --frozen-lockfile || npm install --omit=dev --no-audit --no-fund

EXPOSE 8000
CMD ["npm", "start"]