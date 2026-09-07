# The web UI, in a container.
#
# No dependencies is the premise, so there is no `npm ci` and no build step:
# this image is a Node and the source tree, and nothing else. That is also why
# there is no builder stage to copy out of — there is nothing to build.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# package.json comes along so `--version` and the /options endpoint have
# something to read; there are no dependencies in it to install.
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY worker ./worker

# Where finished runs are kept. `libraryRoot()` honours SEO_AUDIT_HOME ahead of
# everything else, so this is the mount point — much cleaner than guessing at a
# home directory inside the image. Without a volume here, a seven-minute crawl
# dies with the container.
ENV SEO_AUDIT_HOME=/data
RUN mkdir -p /data && chown node:node /data
USER node

ENV PORT=4321
EXPOSE 4321

# Alpine ships no curl; Node 22 has a global fetch. /options is cheap, and it
# is always authorised because serve() injects its own token into every
# request — which is the same reason the port must not be published widely.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/options').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `--host 0.0.0.0` is not optional in a container: serve() defaults to
# 127.0.0.1, which from outside the container answers nothing. What keeps that
# safe is the compose file publishing the port to the host's loopback address,
# not this line. Read the comment there before changing either.
CMD ["sh", "-c", "node bin/seo-audit.mjs --serve ${PORT} --host 0.0.0.0 --no-open"]
