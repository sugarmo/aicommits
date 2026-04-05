<div align="center">
  <div>
    <img src=".github/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
	<p>A CLI that writes your git commit messages for you with AI. Never write a commit message again.</p>
	<a href="https://www.npmjs.com/package/@sugarmo/aicommits"><img src="https://img.shields.io/npm/v/%40sugarmo%2Faicommits" alt="Current version"></a>
</div>

---

## Setup

> The minimum supported version of Node.js is the latest v14. Check your Node.js version with `node --version`.


1. Install _aicommits_:

    ```sh
    npm install -g @sugarmo/aicommits
    ```

2. Retrieve your API key from your API provider

    > Note: If you haven't already, you'll have to create an account and set up billing.

3. Set the key so aicommits can use it:

    ```sh
    aicommits config set api-key=<your token>
    ```

    This will create `~/.aicommits/config.toml`.


### Upgrading

Check the installed version with:
```
aicommits --version
```

If it's not the [latest version](https://github.com/sugarmo/aicommits/releases/latest), run:

```sh
npm update -g @sugarmo/aicommits
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

#### Generate multiple recommendations

Sometimes the recommended commit message isn't the best so you want it to generate a few to pick from. You can generate multiple commit messages at once by passing in the `--generate <i>` flag, where 'i' is the number of generated messages:
```sh
aicommits --generate <i> # or -g <i>
```

> Warning: this uses more tokens, meaning it costs more.

#### Non-interactive environments (Git GUI, external clients, CI)

If your environment does not provide an interactive TTY, skip prompts explicitly:

```sh
aicommits --confirm # or -y / --yes
```

#### Guide output with Markdown

Commit message style is now controlled by a Markdown file instead of individual formatting flags.

By default, aicommits reads `~/.aicommits/message.md`. The file is created automatically on first use.

```sh
aicommits
```

To use a different Markdown file for one run:

```sh
aicommits --message-file release-message.md
```

The default file includes editable instructions for language, title format, body rules, and style. If you were previously using settings like `type`, `details`, `instructions`, or `conventional-*`, upgrade once and those values will be migrated into `message.md` automatically.

#### Post-process the AI response

You can run an executable after the model responds and before the message is shown or committed.

```sh
aicommits --post-response-script rewrite-message.sh
```

The script receives the raw AI message on stdin and must write the final message to stdout.

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

Runtime configuration is read from `~/.aicommits/config.toml` (and CLI flags). Environment variables are not used as config inputs.

The file format is TOML.

### Reading a configuration value
To retrieve a configuration option, use the command:

```sh
aicommits config get <key>
```

For example, to retrieve the API key, you can use:
```sh
aicommits config get api-key
```

You can also retrieve multiple configuration options at once by separating them with spaces:

```sh
aicommits config get api-key generate
```

### Setting a configuration value

To set a configuration option, use the command:

```sh
aicommits config set <key>=<value>
```

For example, to set the API key, you can use:

```sh
aicommits config set api-key=<your-api-key>
```

You can also set multiple configuration options at once by separating them with spaces, like

```sh
aicommits config set api-key=<your-api-key> generate=3
```

### Options
#### api-key

Required

API key for your configured API provider.

#### base-url

Required

Base URL used for API requests.

```sh
aicommits config set base-url=https://api.openai.com/v1
```

#### profile

Default: empty

Selects a named profile from the `profiles` table in `config.toml`.
When a profile is selected, profile values override top-level values.

```sh
aicommits config set profile=openai
```

Example:

```toml
api-key = "top-level-key"
model = "gpt-4o-mini"
profile = "openai"

[profiles.openai]
model = "gpt-5.2-codex"
base-url = "https://api.example.com/v1"
```

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

The model to use for generation.

#### api-mode

Default: `responses`

Controls which API primitive aicommits uses.

- `responses`: default and recommended for new setups
- `chat`: legacy compatibility mode

```sh
aicommits config set api-mode=chat
```


#### timeout
The timeout for network requests to the API in milliseconds.

Default: `10000` (10 seconds)

```sh
aicommits config set timeout=20000 # 20s
```

#### context-window

Default: `0` (auto/default compaction budget)

Set model context size (tokens) so diff compaction can scale to your provider/model window and reduce truncation on large commits.

When set, aicommits reserves part of the window for system prompt and output, then compacts the diff to fit the remaining budget.

```sh
aicommits config set context-window=32768
```

You can also use `K` / `M` suffixes:

```sh
aicommits config set context-window=32K
aicommits config set context-window=1M
```

Use `0` to switch back to auto mode:

```sh
aicommits config set context-window=0
```

#### message-path

Default: `message.md`

Relative paths resolve from `~/.aicommits/`. The referenced Markdown file controls how commit messages should be written.

```sh
aicommits config set message-path=release-message.md
```

#### post-response-script

Default: empty

Relative paths resolve from `~/.aicommits/`. The executable receives the AI response on stdin and must write the final commit message to stdout.

```sh
aicommits config set post-response-script=rewrite-message.sh
```

#### show-reasoning

Default: `false`

By default, aicommits shows normal analyzing progress.  
If the API emits reasoning content, it switches to elapsed thinking time (for example `The AI (gpt-5.4) is thinking for 1m 12s`).
Enable this option to print full streamed model reasoning (debug mode):

```sh
aicommits config set show-reasoning=true
```

Or enable for a single run:

```sh
aicommits --show-reasoning
```

#### reasoning-effort

Default: unset

Controls the model reasoning effort requested by aicommits.

- `none`, `low`, `medium`, `high`, `xhigh`: request an explicit reasoning level

This is the supported way to configure reasoning effort.  
aicommits maps it to `reasoning.effort` for Responses API requests and `reasoning_effort` for Chat requests.

```sh
aicommits config set reasoning-effort=low
```

Or for a single run:

```sh
aicommits --reasoning-effort high
```

#### request-options

Default: empty

Raw JSON object merged into the selected API request body.

Use this for provider-specific fields that do not already have a dedicated aicommits option.  
For reasoning effort, prefer `reasoning-effort` instead of passing `reasoning` or `reasoning_effort` manually.  
Internal fields `model`, `messages`, `instructions`, `input`, and `stream` are controlled by aicommits and cannot be overridden.

```sh
aicommits config set request-options='{"thinking":{"type":"disabled"}}'
```

## How it works

This CLI tool runs `git diff` to grab your latest code changes, sends them to your configured API provider using the Responses API by default, then returns the generated commit message. You can switch back to Chat Completions with `api-mode=chat`.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Maintainers

- **Steven Mok**: [@sugarmo](https://github.com/sugarmo)


## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/sugarmo/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project.
