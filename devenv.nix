{ pkgs, ... }:
{
  packages = with pkgs; [
    miniserve # static file server for dist/
    watchexec # rebuilds dist/ when a source file changes
    biome # format and lint the JS FFI files

    # Gleam + Lustre, compiled to JavaScript
    gleam
    erlang # gleam's build tool and lustre_dev_tools run on the BEAM
    rebar3 # builds Erlang dependencies of lustre_dev_tools
    bun # lustre_dev_tools bundles with bun; gleam.toml sets bin.bun = "system"
          # so it uses this one instead of downloading a binary into .lustre/
    gh
    jq
  ];

  # Headless browser checks (Playwright MCP or scripts) use the Nix-built browsers
  env = {
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  };

  # `devenv up`: rebuild on change, the site on http://127.0.0.1:8000 and a browser on it.
  # It serves the same dist/ that the GitHub Actions workflow deploys.
  processes = {
    build = {
      exec = "watchexec --watch src --watch assets --watch gleam.toml --debounce 300ms -- gleam run -m lustre/dev build";
    };
    web = {
      exec = "mkdir -p dist && miniserve --interfaces 127.0.0.1 --port 8000 --index index.html dist";
      ready = {
        period = 1;
        http.get = {
          host = "127.0.0.1";
          port = 8000;
          path = "/";
        };
      };
    };
    chromium = {
      exec = "chromium --user-data-dir=$DEVENV_STATE/chromium --no-first-run --no-default-browser-check http://127.0.0.1:8000/";
      after = [ "devenv:processes:web" ];
    };
  };

  enterShell = ''
    echo "Wunschzettel: devenv up builds and serves the site on http://127.0.0.1:8000"
  '';
}
