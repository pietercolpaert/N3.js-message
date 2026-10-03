# Security Policy

## Supported versions

Security fixes are applied to the latest release.

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.
Use [GitHub's private vulnerability reporting](https://github.com/pietercolpaert/n3.js-messages/security/advisories/new)
(_Security_ → _Report a vulnerability_) instead.

## Scope

This package parses untrusted text. Inputs that make the parser or writer hang, consume memory
that is not proportional to the size of one message, or execute code, are in scope.
Syntax errors in malformed documents are not vulnerabilities.
