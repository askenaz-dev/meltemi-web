# The Cloudflare provider reads its token from CLOUDFLARE_API_TOKEN and the GitHub provider from
# GITHUB_TOKEN: both are bootstrap secrets of this repository's `infrastructure` environment, and
# nothing here names a credential.
provider "cloudflare" {}

provider "github" {
  owner = var.github_owner
}
