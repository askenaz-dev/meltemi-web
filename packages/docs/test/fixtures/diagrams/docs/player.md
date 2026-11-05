# The HTML player

[Español](es/player.md)

The player plays a story in any browser, from one HTML file, with pause, progress and a static
view. Its pictures are the same as the [exports of a story](language/stories.md#exports).

[![npm](https://img.shields.io/npm/v/@meltemi/diagrams-cli)](https://www.npmjs.com/package/@meltemi/diagrams-cli)

## Writing a player

Export a story with `--format html`; what changed is in the [changelog](../CHANGELOG.md), and the
[command line][cli] has every option. A link written in code stays as written:
`[stories](language/stories.md)`.

![The editor, the canvas and the player](media/editing-demo.gif)

<a href="cli.md">The command line, linked in HTML</a>

```text
[not a link](nowhere.md)
```

[cli]: cli.md
