# imap-proto compatibility patch

Source: crates.io `imap-proto` 0.10.2, from https://github.com/djc/tokio-imap.
Upstream commit: `08f269400ec95b176d30cac7b23730820fe94d7e`.
Author: Dirkjan Ochtman. License: MIT OR Apache-2.0 (see Cargo.toml).

`imap` 2.4 requires the 0.10 parser API. This local patch removes trailing
semicolons from four expression macro arms in `src/macros.rs`, fixing Rust's
`semicolon_in_expressions_from_macros` future incompatibility without changing
the mailbox API or parsing behavior. Local compilation also exposes upstream
warnings normally capped for registry dependencies: the patch makes six return
lifetimes explicit and removes an unused payload from the private metadata
parser's initial state. All other Rust sources are unchanged.

Validate from the API directory with
`cargo test --manifest-path vendor/imap-proto/Cargo.toml --lib --target-dir target`.
Remove this patch when the mail client uses a compatible upstream parser.
