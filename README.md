<div align="center">
  <div>
    <img src=".github/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
	<p>A CLI that writes your git commit messages for you with AI. Never write a commit message again.</p>
	<a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/v/aicommits" alt="Current version"></a>
</div>

---

## Setup

> The minimum supported version of Node.js is the latest v14. Check your Node.js version with `node --version`.


1. Install _aicommits_:

    ```sh
    npm install -g aicommits
    ```

2. Retrieve your API key from [OpenAI](https://platform.openai.com/account/api-keys)

    > Note: If you haven't already, you'll have to create an account and set up billing.

3. Set the key so aicommits can use it:

    ```sh
    aicommits config set OPENAI_KEY=<your token>
    ```

    This will create a `.aicommits` file in your home directory.


### Upgrading

Check the installed version with:
```
aicommits --version
```

If it's not the [latest version](https://github.com/Nutlope/aicommits/releases/latest), run:

```sh
npm update -g aicommits
```

## Usage
### CLI mode

You can call `aicommits` directly to generate a commit message for your staged changes:

```sh
git add <files...>
aicommits
```

`aicommits` passes down unknown flags to `git commit`, so you can pass in [`commit` flags](https://git-scm.com/docs/git-commit).

For example, you can stage all changes in tracked files with as you commit:
```sh
aicommits --all # or -a
```

> 👉 **Tip:** Use the `aic` alias if `aicommits` is too long for you.

#### Generate multiple recommendations

Sometimes the recommended commit message isn't the best so you want it to generate a few to pick from. You can generate multiple commit messages at once by passing in the `--generate <i>` flag, where 'i' is the number of generated messages:
```sh
aicommits --generate <i> # or -g <i>
```

> Warning: this uses more tokens, meaning it costs more.

#### Generate title + details

If you want both a commit title and body:

```sh
aicommits --details
```

If you prefer a bullet-list body style:

```sh
aicommits --details --details-style list
```

#### Default style

The generator uses a GitHub Copilot-like style by default and prefers commit titles with a concrete file/class/module anchor so commit lists are easier to scan.

You can still fine-tune output using custom instructions:

```sh
aicommits --details --instructions "Use shorter body sentences and prioritize class names in the title"
```

#### Customize conventional format

You can combine conventional commits with custom output format and type mapping:

```sh
aicommits --type conventional --conventional-format "<type>(<scope>): <subject>" --conventional-types '{"feature":"Introduce a feature","bugfix":"Fix defects"}'
```

By default, conventional mode also prefers including scope (for example `refactor(RecentScrollshotController): ...`) when there is a clear dominant file/class/module. You can disable this behavior with:

```sh
aicommits --conventional-scope false
```

### Git hook

You can also integrate _aicommits_ with Git via the [`prepare-commit-msg`](https://git-scm.com/docs/githooks#_prepare_commit_msg) hook. This lets you use Git like you normally would, and edit the commit message before committing.

#### Install

In the Git repository you want to install the hook in:
```sh
aicommits hook install
```

#### Uninstall
In the Git repository you want to uninstall the hook from:

```sh
aicommits hook uninstall
```

#### Usage

1. Stage your files and commit:
    ```sh
    git add <files...>
    git commit # Only generates a message when it's not passed in
    ```

    > If you ever want to write your own message instead of generating one, you can simply pass one in: `git commit -m "My message"`

2. Aicommits will generate the commit message for you and pass it back to Git. Git will open it with the [configured editor](https://docs.github.com/en/get-started/getting-started-with-git/associating-text-editors-with-git) for you to review/edit it.

3. Save and close the editor to commit!

## Configuration

### Reading a configuration value
To retrieve a configuration option, use the command:

```sh
aicommits config get <key>
```

For example, to retrieve the API key, you can use:
```sh
aicommits config get OPENAI_KEY
```

You can also retrieve multiple configuration options at once by separating them with spaces:

```sh
aicommits config get OPENAI_KEY generate
```

### Setting a configuration value

To set a configuration option, use the command:

```sh
aicommits config set <key>=<value>
```

For example, to set the API key, you can use:

```sh
aicommits config set OPENAI_KEY=<your-api-key>
```

You can also set multiple configuration options at once by separating them with spaces, like

```sh
aicommits config set OPENAI_KEY=<your-api-key> generate=3 locale=en
```

### Options
#### OPENAI_KEY

Required

The OpenAI API key. You can retrieve it from [OpenAI API Keys page](https://platform.openai.com/account/api-keys).

#### locale
Default: `en`

The locale to use for the generated commit messages. Consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes.

Common aliases are normalized automatically (for example `cn` -> `zh-CN`).

#### generate

Default: `1`

The number of commit messages to generate to pick from.

Note, this will use more tokens as it generates more results.

#### proxy

Set a HTTP/HTTPS proxy to use for requests.

To clear the proxy option, you can use the command (note the empty value after the equals sign):

```sh
aicommits config set proxy=
```

#### model

Default: `gpt-3.5-turbo`

The Chat Completions (`/v1/chat/completions`) model to use. Consult the list of models available in the [OpenAI Documentation](https://platform.openai.com/docs/models/model-endpoint-compatibility).

You can also override it per-run with environment variables:

```sh
OPENAI_MODEL=gpt-4o-mini aicommits
```

> Tip: If you have access, try upgrading to [`gpt-4`](https://platform.openai.com/docs/models/gpt-4) for next-level code analysis. It can handle double the input size, but comes at a higher cost. Check out OpenAI's website to learn more.


#### timeout
The timeout for network requests to the OpenAI API in milliseconds.

Default: `10000` (10 seconds)

```sh
aicommits config set timeout=20000 # 20s
```

#### max-length
The maximum character length of the generated commit message.

Default: `50`

```sh
aicommits config set max-length=100
```

#### type

Default: plain format

Set commit type formatting:

```sh
aicommits config set type=conventional
```

#### details

Default: `false`

Set this to `true` to generate title and body:

```sh
aicommits config set details=true
```

#### details-style

Default: `paragraph`

Controls body formatting when `details=true`.

Allowed values: `paragraph`, `list`

```sh
aicommits config set details-style=list
```

#### temperature

Sampling temperature for AI generation.

Valid range: `0` to `2`

```sh
aicommits config set temperature=1
```

If unset, the model/provider default is used.

#### instructions

Default: empty

Additional custom prompt instructions:

```sh
aicommits config set instructions="Use short and direct wording"
```

#### conventional-format

Default: `<type>[optional (<scope>)]: <commit message>`

Customize the conventional output template:

```sh
aicommits config set conventional-format="<type>(<scope>): <subject>"
```

#### conventional-types

Default: built-in conventional type map

Customize type descriptions with JSON:

```sh
aicommits config set conventional-types='{"feature":"Introduce a feature","bugfix":"Fix defects"}'
```

#### conventional-scope

Default: `true`

When enabled, conventional commits strongly prefer `type(scope): subject` using the primary file/class/module as scope.

```sh
aicommits config set conventional-scope=true
```

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Maintainers

- **Hassan El Mghari**: [@Nutlope](https://github.com/Nutlope) [<img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/nutlope)


- **Hiroki Osame**: [@privatenumber](https://github.com/privatenumber) [<img src="https://img.shields.io/twitter/follow/privatenumbr?style=flat&label=privatenumbr&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/privatenumbr)


## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/Nutlope/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project.
