# The state lives in the account's R2 bucket `meltemi-terraform-state`, the one resource created
# by hand (the bootstrap in README.md), since the state that would manage it lives in it. R2 speaks
# the S3 API; its atomic `If-None-Match` writes make the backend's lock file a real lock. The
# endpoint and the credentials come from the pipeline's environment:
#   AWS_ENDPOINT_URL_S3   https://<account id>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID     the R2 API token's access key id
#   AWS_SECRET_ACCESS_KEY the R2 API token's secret access key
terraform {
  backend "s3" {
    bucket       = "meltemi-terraform-state"
    key          = "family.tfstate"
    region       = "auto"
    use_lockfile = true

    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
