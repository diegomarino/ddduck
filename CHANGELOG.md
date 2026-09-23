# Changelog

## [0.3.0](https://github.com/diegomarino/ddduck/compare/ddduck-v0.2.0...ddduck-v0.3.0) (2026-09-23)


### Features

* add --version and -v to the ddduck CLI ([#16](https://github.com/diegomarino/ddduck/issues/16)) ([8681e60](https://github.com/diegomarino/ddduck/commit/8681e604ecd7bcad14153820d392db5b2c1a3ba9))
* delegate install skill to the skills CLI ([#15](https://github.com/diegomarino/ddduck/issues/15)) ([5a2069f](https://github.com/diegomarino/ddduck/commit/5a2069fe68e6aff2c431648e1bdba5fee44e0280)), closes [#12](https://github.com/diegomarino/ddduck/issues/12)


### Bug Fixes

* **skills:** give update-ddduck-specs an executable probe order ([#18](https://github.com/diegomarino/ddduck/issues/18)) ([09dbacc](https://github.com/diegomarino/ddduck/commit/09dbacc0ad85fb5ed0d1c341cc5058edbe77cd24))

## [0.2.0](https://github.com/diegomarino/ddduck/compare/ddduck-v0.1.2...ddduck-v0.2.0) (2026-09-22)


### Features

* add lightweight definition and change-review workflows ([#8](https://github.com/diegomarino/ddduck/issues/8)) ([17df7ac](https://github.com/diegomarino/ddduck/commit/17df7acc08064f2861e278cd8616d249ffceb61b))

## [0.1.2](https://github.com/diegomarino/ddduck/compare/ddduck-v0.1.1...ddduck-v0.1.2) (2026-08-06)


### Bug Fixes

* **check:** enforce lifecycle history, evidence anchors, and node placement ([235e7b7](https://github.com/diegomarino/ddduck/commit/235e7b703f66c2336254f39aa092fd4b8c93b923))
* **cli:** clearer root resolution, targeted errors, and safer operations ([279c398](https://github.com/diegomarino/ddduck/commit/279c398d1a2a4620e8a6bdbeff645f01c06d186e))
* **cli:** shell-quote the generated retry command and correct the unknown-id pointer ([2e0259e](https://github.com/diegomarino/ddduck/commit/2e0259e50c21bd0bc307eb7b93ad6b9956f6a15d))
* **evals:** run the shipped eval harness without devDependencies ([79762e2](https://github.com/diegomarino/ddduck/commit/79762e27980a0745c58c2ef313579bc3dbab60d4))
* exclude the generated CHANGELOG from the markdown lint and format gates ([#3](https://github.com/diegomarino/ddduck/issues/3)) ([1c50cf6](https://github.com/diegomarino/ddduck/commit/1c50cf60046c841080ee61d9072cf0dca5628a83))
* **generate:** honest generated views and tidy variant placement ([990a245](https://github.com/diegomarino/ddduck/commit/990a245d4108e0b8fef0df005e32fe58904759d0))


### Documentation

* align guides with actual CLI behavior ([d2143be](https://github.com/diegomarino/ddduck/commit/d2143be5266b9510dd5b7054914230df5db57f53))
* **scripts:** add purpose headers and JSDoc across the remaining scripts ([ec9e129](https://github.com/diegomarino/ddduck/commit/ec9e129aa8a53f780c8dc2f933403fe28482b38e))

## [0.1.1](https://github.com/diegomarino/ddduck/compare/ddduck-v0.1.0...ddduck-v0.1.1) (2026-08-05)


### Bug Fixes

* return a directory from findRepositoryRoot when no .git ancestor exists ([#1](https://github.com/diegomarino/ddduck/issues/1)) ([b145e57](https://github.com/diegomarino/ddduck/commit/b145e5703e98f7997bb48cca7644c733c6c51ec9))
