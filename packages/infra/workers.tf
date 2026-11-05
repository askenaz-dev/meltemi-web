# The Workers of the family and their storage. Terraform declares each Worker as an entity (its
# name, no workers.dev address, no preview addresses, observability) and its domain; the product
# repositories upload the versions (code, static assets, Durable Object migrations) with
# `wrangler deploy`, onto these entities.

resource "cloudflare_d1_database" "identity" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-identity"
}

resource "cloudflare_d1_database" "diagrams" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-diagrams"
}

resource "cloudflare_r2_bucket" "diagrams_blobs" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-diagrams-blobs"
}

# The state of Meltemi Diagrams' OAuth authorization server (its change agent-mcp), bound as
# `OAUTH_KV` by the main Worker: grants, clients and tokens, one namespace per environment.
resource "cloudflare_workers_kv_namespace" "diagrams_oauth" {
  account_id = var.cloudflare_account_id
  title      = "meltemi-diagrams-oauth"
}

# Staging, production's twin for Meltemi Diagrams (change diagrams-staging): the same code,
# uploaded by Diagrams' deploy before production's, onto its own database, bucket and namespace,
# so a suite that passes there says something about production and touches none of its data.
resource "cloudflare_d1_database" "diagrams_staging" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-diagrams-staging"
}

resource "cloudflare_r2_bucket" "diagrams_staging_blobs" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-diagrams-staging-blobs"
}

resource "cloudflare_workers_kv_namespace" "diagrams_oauth_staging" {
  account_id = var.cloudflare_account_id
  title      = "meltemi-diagrams-oauth-staging"
}

locals {
  # Each Worker, its repository, and the host that serves it.
  workers = {
    identity = { name = "meltemi-identity", repository = "meltemi-web", hostname = "id.meltemi.dev", zone = "dev" }
    site     = { name = "meltemi-site", repository = "meltemi-web", hostname = "meltemi.dev", zone = "dev" }
    diagrams = { name = "meltemi-diagrams-cloud", repository = "meltemi-diagrams", hostname = "diagrams.meltemi.dev", zone = "dev" }
    publish  = { name = "meltemi-diagrams-publish", repository = "meltemi-diagrams", hostname = "meltemi.page", zone = "page" }
    docs     = { name = "meltemi-docs", repository = "meltemi-web", hostname = "docs.meltemi.dev", zone = "dev" }
    # The staging twin of the two Diagrams Workers (change diagrams-staging).
    diagrams_staging = { name = "meltemi-diagrams-staging", repository = "meltemi-diagrams", hostname = "staging.diagrams.meltemi.dev", zone = "dev" }
    publish_staging  = { name = "meltemi-diagrams-publish-staging", repository = "meltemi-diagrams", hostname = "staging.meltemi.page", zone = "page" }
  }

  # The Workers whose domains wait for `staging_deployed`.
  staging_workers = ["diagrams_staging", "publish_staging"]

  # The names and hosts given to more than one Worker; none.
  shared_worker_names = [
    for name in distinct([for worker in local.workers : worker.name]) : name
    if length([for worker in local.workers : worker if worker.name == name]) > 1
  ]
  shared_worker_hosts = [
    for host in distinct([for worker in local.workers : worker.hostname]) : host
    if length([for worker in local.workers : worker if worker.hostname == host]) > 1
  ]

  zone_ids = {
    dev  = cloudflare_zone.dev.id
    page = cloudflare_zone.page.id
  }

  # A Custom Domain needs a Worker with a version, so none exists before `attach_domains`; the
  # apex of meltemi.dev is the site's only once GitHub Pages has let it go (`site_on_apex`); the
  # documentation portal's waits for its first upload (`docs_deployed`, change docs-portal); and
  # staging's two wait for the first upload of Diagrams' staging deploy (`staging_deployed`,
  # change diagrams-staging).
  attached = {
    for key, worker in local.workers : key => worker
    if var.attach_domains && (key != "site" || var.site_on_apex) && (key != "docs" || var.docs_deployed) && (!contains(local.staging_workers, key) || var.staging_deployed)
  }
}

resource "cloudflare_worker" "family" {
  for_each = local.workers

  account_id = var.cloudflare_account_id
  name       = each.value.name

  subdomain = {
    enabled          = false
    previews_enabled = false
  }

  observability = {
    enabled = true
    logs = {
      enabled         = true
      invocation_logs = true
    }
  }

  lifecycle {
    # Two entries with one name would be one Worker uploaded by two deploys (a staging entry copied
    # from production's and left unrenamed, say), and two with one host one Custom Domain.
    precondition {
      condition     = length(local.shared_worker_names) == 0 && length(local.shared_worker_hosts) == 0
      error_message = "Each Worker needs a name and a host of its own: ${join(", ", concat(local.shared_worker_names, local.shared_worker_hosts))} is given twice."
    }
  }
}

resource "cloudflare_workers_custom_domain" "family" {
  for_each = local.attached

  account_id = var.cloudflare_account_id
  hostname   = each.value.hostname
  service    = cloudflare_worker.family[each.key].name
  zone_id    = local.zone_ids[each.value.zone]
}

# www.meltemi.dev answers with a permanent redirect to the apex, keeping the path and the query: a
# Worker of a few lines that belongs to no product repository, so it is uploaded here, and only
# www's requests run it. Its Custom Domain comes with the site's.
locals {
  www_redirect = <<-EOT
    // www.meltemi.dev -> meltemi.dev, keeping the path and the query.
    export default {
      fetch(request) {
        const url = new URL(request.url);
        url.protocol = "https:";
        url.hostname = "meltemi.dev";
        url.port = "";
        return Response.redirect(url.href, 301);
      },
    };
  EOT
}

resource "cloudflare_worker" "www" {
  account_id = var.cloudflare_account_id
  name       = "meltemi-www"

  subdomain = {
    enabled          = false
    previews_enabled = false
  }
}

resource "cloudflare_worker_version" "www" {
  account_id         = var.cloudflare_account_id
  worker_id          = cloudflare_worker.www.id
  compatibility_date = "2026-09-15"
  main_module        = "www.mjs"
  modules = [{
    name           = "www.mjs"
    content_type   = "application/javascript+module"
    content_base64 = base64encode(local.www_redirect)
  }]
}

resource "cloudflare_workers_deployment" "www" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.www.name
  strategy    = "percentage"
  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.www.id
  }]
}

resource "cloudflare_workers_custom_domain" "www" {
  count = var.attach_domains && var.site_on_apex ? 1 : 0

  account_id = var.cloudflare_account_id
  hostname   = "www.meltemi.dev"
  service    = cloudflare_worker.www.name
  zone_id    = cloudflare_zone.dev.id

  depends_on = [cloudflare_workers_deployment.www]
}
