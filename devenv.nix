{ pkgs, ... }:
{
  packages = with pkgs; [
    miniserve # static file server for index.html
    biome # format and lint the JS and CSS in index.html
    gh
    jq
  ];

  # Headless browser checks (Playwright MCP or scripts) use the Nix-built browsers
  env = {
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  };

  # `devenv up`: the site on http://127.0.0.1:8000 and a browser on it
  processes = {
    web = {
      exec = "miniserve --interfaces 127.0.0.1 --port 8000 --index index.html .";
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
    echo "Wunschzettel: devenv up serves the site on http://127.0.0.1:8000"
  '';
}
