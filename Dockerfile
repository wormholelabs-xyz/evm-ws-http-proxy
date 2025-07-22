FROM node:24.4.1-slim@sha256:36ae19f59c91f3303c7a648f07493fe14c4bd91320ac8d898416327bacf1bbfa

WORKDIR /build

COPY . .
RUN npm ci

EXPOSE 8080
CMD ["npm", "start"]
