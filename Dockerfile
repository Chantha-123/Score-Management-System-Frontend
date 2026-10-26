FROM timbru31/ruby-node:2.7 AS development

RUN mkdir /usr/src/app
WORKDIR /usr/src/app
ENV PATH /usr/src/app/node_modules/.bin:$PATH

RUN npm install -g bower grunt-cli

# Copy only dependency manifests first so this layer (and the installs below)
# stay cached across builds unless a dependency actually changes.
COPY package.json package-lock.json bower.json .bowerrc gems.rb /usr/src/app/
RUN npm ci
RUN bower --allow-root install
RUN bundle install

COPY . /usr/src/app
EXPOSE 9002 35729
CMD ["grunt", "serve"]

FROM nginx:1.28-alpine AS dev-proxy
ENV API_UPSTREAM=http://api:8080
COPY docker/nginx.dev.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

FROM development AS builder
RUN grunt prod

FROM nginx:1.28-alpine AS production
ENV API_UPSTREAM=http://api:8080
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /usr/src/app/dist/community-app /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
