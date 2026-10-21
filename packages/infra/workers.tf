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

locals {
  # Each Worker, its repository, and the host that serves it.
  workers = {
    identity = { name = "meltemi-identity", repository = "meltemi-web", hostname = "id.meltemi.dev", zone = "dev" }
    site     = { name = "meltemi-site", repository = "meltemi-web", hostname = "meltemi.dev", zone = "dev" }
    diagrams = { name = "meltemi-diagrams-cloud", repository = "meltemi-diagrams", hostname = "diagrams.meltemi.dev", zone = "dev" }
    publish  = { name = "meltemi-diagrams-publish", repository = "meltemi-diagrams", hostname = "meltemi.page", zone = "page" }
  }

  zone_ids = {
    dev  = cloudflare_zone.dev.id
    page = cloudflare_zone.page.id
  }

  # A Custom Domain needs a Worker with a version, so none exists before `attach_domains`; and the
  # apex of meltemi.dev is the site's only once GitHub Pages has let it go (`site_on_apex`).
  attached = {
    for key, worker in local.workers : key => worker
    if var.attach_domains && (key != "site" || var.site_on_apex)
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
