# Changelog

## [0.0.5](https://github.com/Osyx/ddex/compare/ddex-v0.0.4...ddex-v0.0.5) (2026-03-03)


### Features

* add --keep-unzipped flag, show tip when extracting zip ([ce3590f](https://github.com/Osyx/ddex/commit/ce3590f094795113d35044b0bbd38c5708d3a135))
* add core infrastructure for new subcommands ([d8efba4](https://github.com/Osyx/ddex/commit/d8efba441c15959d9abd502c453e442b99599878))
* add emojis and attachments subcommands ([4cc5334](https://github.com/Osyx/ddex/commit/4cc533405a5af563bf1faec294062f55b748f321))
* add prediction subcommand ([887c3b6](https://github.com/Osyx/ddex/commit/887c3b61ffcbb63119a2ba18d1c5cc7b3da81b21))
* add servers and time subcommands ([6faf7ca](https://github.com/Osyx/ddex/commit/6faf7cabb59e670919164c225fd5e0a2d2def8a8))
* add spent and people subcommands ([0c73145](https://github.com/Osyx/ddex/commit/0c731452ae22eedec78b44e6218be2156a7756dd))
* add stats subcommand ([e180cf4](https://github.com/Osyx/ddex/commit/e180cf41c9c9c58f272a8ad511ba06702aef953f))
* count DM calls per partner via call_button_clicked Disconnect events ([2f1e7fb](https://github.com/Osyx/ddex/commit/2f1e7fbc36826d019c6ff6203506eaa767049796))
* fit all output to terminal width ([b09a4cf](https://github.com/Osyx/ddex/commit/b09a4cffe9b0a6fd895a8cfd554ae454b6fd7584))
* show orb total in parentheses on spent summary ([e763c20](https://github.com/Osyx/ddex/commit/e763c20e76df9bddc9735b0cc300105155314f85))
* split stats highlights into channel/group DM/DM, strip DM prefix from name ([6743bfc](https://github.com/Osyx/ddex/commit/6743bfcdf9f251edb99d432be49686363f353c10))
* wire all subcommands into CLI ([074c501](https://github.com/Osyx/ddex/commit/074c5016af9197840f0d8caf55dc316322b3b2a1))


### Bug Fixes

* clear progress line on done, truncate table columns to width ([d4a4ceb](https://github.com/Osyx/ddex/commit/d4a4cebebe97a0b1326757894768c79d08ee3cb2))
* drop redundant server name suffix from most active channel stat ([4126538](https://github.com/Osyx/ddex/commit/4126538fd324c8ecdab7e961bba5d55e07b084b4))
* exclude DMs from top text channels list ([8f954ec](https://github.com/Osyx/ddex/commit/8f954ec27355837c97a57037845b0d55964abf13))
* find analytics events across all Activity subfolders, drop package/ wrapper ([cb674ce](https://github.com/Osyx/ddex/commit/cb674ce511ce806f6e18efc95ef3916d107c0fb1))
* resolve lint errors in analytics, people, servers, analyze ([d22fb6f](https://github.com/Osyx/ddex/commit/d22fb6fef21a9be4411116a36915b977f65d077c))
* resolve lint errors in stats, emojis, parser, attachments, predictor, index, cmd ([21ef6e1](https://github.com/Osyx/ddex/commit/21ef6e12376438b17cf8dc2147b303575014c263))
* resolve lint errors in time, metadata, spent ([b82f796](https://github.com/Osyx/ddex/commit/b82f796c811a742193757ad7256994b0adae1b67))
* restore variant clustering for short words and large phonetic buckets ([caee936](https://github.com/Osyx/ddex/commit/caee936c0c9771a6f15df42b22fa0d9409953972))
* revert analytics to readline streaming, resolve all test lint errors ([fc60099](https://github.com/Osyx/ddex/commit/fc60099ef57da7243637f78725ca00d9691ab818))
* stats separate channel/DM highlights, remove dollar signs, DISCORD_ORB to Orbs, calls instead of voice hours ([b8fad93](https://github.com/Osyx/ddex/commit/b8fad932fe3d7323d686900c5975844b8b773566))
* strip legacy #discriminator suffix from DM partner names ([cc925a6](https://github.com/Osyx/ddex/commit/cc925a6d26145ac2538039dade59d312fc84d1b3))
* update stale package/ path in predictor error message ([ae07094](https://github.com/Osyx/ddex/commit/ae0709422006dc41842d3b93795fcf96be3ddfa7))
* use guild_id=null to detect DM voice sessions, show total DM voice hours ([edb10e1](https://github.com/Osyx/ddex/commit/edb10e1e337a47410355bdea698e8293e18c5179))


### Performance Improvements

* only extract relevant files per command ([0bd0d65](https://github.com/Osyx/ddex/commit/0bd0d6570fe8ae35f926169f4a74ee7c15ac83ce))
* replace readline with Bun.file().text(), regex event_type extraction, parallel batch message reads ([68b6fa8](https://github.com/Osyx/ddex/commit/68b6fa8d0a9182f2314668724cffc566a3316823))


### Documentation

* add files for agent driven development ([a4995e2](https://github.com/Osyx/ddex/commit/a4995e27ea9a055cadcf1297d7db78f77a8cc961))

## [0.0.4](https://github.com/Osyx/ddex/compare/ddex-v0.0.3...ddex-v0.0.4) (2026-03-02)


### Features

* add comprehensive test suite ([539350f](https://github.com/Osyx/ddex/commit/539350fcdfd3d620ee2b3d37658e2960dbd7a571))
* add tests and fix path/encoding issues with parser and tokenizer ([7bd2938](https://github.com/Osyx/ddex/commit/7bd2938abbfcb513df606105b3ecf418292e669f))
* add words subcommand (ddex words &lt;path&gt; [options]) ([523d277](https://github.com/Osyx/ddex/commit/523d277d53e3154db4824ae21532c27fab8a3a89))
* enhance clustering logic to normalize repeated characters and refine edit distance thresholds ([98ddcdc](https://github.com/Osyx/ddex/commit/98ddcdc6ea118804c7476af4b56aee29924610b4))
* enhance file extraction and parsing logic, add version option, and improve progress updates ([a31fc1b](https://github.com/Osyx/ddex/commit/a31fc1ba7f83a7fb1fe1dc4f04c6411e1bb61e36))
* initial commit ([9168623](https://github.com/Osyx/ddex/commit/91686230158b61c29ba9692092db170f06eb4f5f))
* optimize clustering by adding guard for large buckets and improving sorting logic ([9e6d118](https://github.com/Osyx/ddex/commit/9e6d118655fca6ae3d6043f635dac80045f23890))
* switch zip library due to memory issues and switch word processing to more focused libraries ([f47688a](https://github.com/Osyx/ddex/commit/f47688afdea74ed01b2df4339119ae77409964fd))
* update workflows for better CI and testing ([8094581](https://github.com/Osyx/ddex/commit/8094581c288c3b8b4b70a9640c39cefec3e676bf))

## [0.0.3](https://github.com/Osyx/ddex/compare/discord-mcd-v0.0.2...discord-mcd-v0.0.3) (2026-03-02)


### Features

* add comprehensive test suite ([539350f](https://github.com/Osyx/ddex/commit/539350fcdfd3d620ee2b3d37658e2960dbd7a571))
* enhance file extraction and parsing logic, add version option, and improve progress updates ([a31fc1b](https://github.com/Osyx/ddex/commit/a31fc1ba7f83a7fb1fe1dc4f04c6411e1bb61e36))
* optimize clustering by adding guard for large buckets and improving sorting logic ([9e6d118](https://github.com/Osyx/ddex/commit/9e6d118655fca6ae3d6043f635dac80045f23890))
* update workflows for better CI and testing ([8094581](https://github.com/Osyx/ddex/commit/8094581c288c3b8b4b70a9640c39cefec3e676bf))

## [0.0.2](https://github.com/Osyx/ddex/compare/discord-mcd-v0.0.1...discord-mcd-v0.0.2) (2026-03-02)


### Features

* add tests and fix path/encoding issues with parser and tokenizer ([7bd2938](https://github.com/Osyx/ddex/commit/7bd2938abbfcb513df606105b3ecf418292e669f))
* enhance clustering logic to normalize repeated characters and refine edit distance thresholds ([98ddcdc](https://github.com/Osyx/ddex/commit/98ddcdc6ea118804c7476af4b56aee29924610b4))
* switch zip library due to memory issues and switch word processing to more focused libraries ([f47688a](https://github.com/Osyx/ddex/commit/f47688afdea74ed01b2df4339119ae77409964fd))

## [0.0.1](https://github.com/Osyx/ddex/compare/discord-mcd-v0.0.1...discord-mcd-v0.0.1) (2026-03-02)


### Features

* initial commit ([9168623](https://github.com/Osyx/ddex/commit/91686230158b61c29ba9692092db170f06eb4f5f))
