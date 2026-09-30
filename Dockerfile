# Task environment for the investor-report view-limit task.
# Build (needs network once):   docker build -t smartbiz-task .
# Everything after the build runs offline, e.g.  docker run --network none ...
#
# The image holds the repo at BASE_COMMIT as a git repo in /repo. task/ and
# solution/ are excluded (see .dockerignore) so an agent working in the
# container cannot see the blockers or the golden patch.
FROM node:20.19.0-bookworm@sha256:a5fb035ac1dff34a4ecaea85f90f7321185695d3fd22c12ba12f4535a4647cc5

ENV MONGOMS_VERSION=7.0.14 \
    MONGOMS_DOWNLOAD_DIR=/opt/mongodb-binaries \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Blocker-test harness (mongodb-memory-server, pinned by its lockfile), kept
# outside the repo. The mongod binary is downloaded and cached here, at build
# time, so MongoDB runs inside the container with no network at test time.
WORKDIR /opt/blockers
COPY docker/blockers-harness/package.json docker/blockers-harness/package-lock.json ./
RUN npm ci \
 && node -e "require('mongodb-memory-server').MongoMemoryServer.create().then((m) => m.stop())"

# Repo dependencies from the lockfile.
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci

# Repo source at the base commit, committed so any change is visible via `git diff`.
# Line endings are normalised to LF so the image is identical whether it was
# built from a Windows or a Linux checkout (the patches are LF).
COPY . .
RUN rm -rf docker ATTESTATION.md \
 && grep -rlI --exclude-dir=node_modules "$(printf '\r')" . | xargs -r sed -i 's/\r$//' \
 && find . -path ./node_modules -prune -o -type f -perm /111 -exec chmod 644 {} + \
 && git init -q \
 && git -c user.name=task -c user.email=task@localhost add -A \
 && git -c user.name=task -c user.email=task@localhost commit -qm "base $(cat BASE_COMMIT)" \
 && npx tsc --noEmit

CMD ["bash"]
