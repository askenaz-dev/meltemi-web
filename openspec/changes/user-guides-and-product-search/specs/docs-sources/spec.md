## ADDED Requirements

### Requirement: Explicit translations preserve canonical source paths
The converter SHALL recognize docs/en and docs/es locales and preserve detected canonical-root
IDE languages even when translated folders exist. Current curated guides SHALL have real
bilingual sources; older releases and fixtures MAY retain one-language notices. Duplicate
locale/id sources SHALL fail conversion.

#### Scenario: A Spanish canonical guide and an English translation
- **WHEN** IDE contains Spanish docs/acceso-remoto.md and English docs/en/acceso-remoto.md
- **THEN** both produce genuine locale guides at the existing product route

#### Scenario: Duplicate translation
- **WHEN** two source files target the same language and guide id
- **THEN** conversion fails naming both files

### Requirement: Relative links follow the source language
Relative user-guide links SHALL prefer a genuine guide of the source locale. Explicitly named
other-language links SHALL retain their target. Missing referenced files SHALL fail conversion.

#### Scenario: A translated guide links the canonical file
- **WHEN** a Spanish guide links a canonical English file that has a Spanish translation
- **THEN** the portal link reaches the Spanish guide with the anchor preserved

#### Scenario: A referenced guide does not exist
- **WHEN** a link names no real source file or recognized translation
- **THEN** conversion fails with the source filename and missing reference

#### Scenario: A Markdown link label wraps across lines
- **WHEN** a guide wraps a link label within a paragraph
- **THEN** its destination is converted while literal links in inline and fenced code remain intact
