#!/usr/bin/env bash
# สร้าง VM บน Azure พร้อม static IP และ firewall (NSG)
set -euo pipefail

RG="${RG:-mini-siem-rg}"
LOCATION="${LOCATION:-eastasia}"
VM="${VM:-mini-siem}"
SIZE="${SIZE:-Standard_B2as_v2}"
SIZE_FALLBACKS="${SIZE_FALLBACKS:-Standard_B2s_v2 Standard_B2ms Standard_B2als_v2 Standard_B2ls_v2}"
IMAGE="${IMAGE:-Ubuntu2204}"
ADMIN="${ADMIN:-azureuser}"
DISK_GB="${DISK_GB:-40}"

ADMIN_SOURCE_IP="${ADMIN_SOURCE_IP:-}"
SYSLOG_SOURCE_IPS="${SYSLOG_SOURCE_IPS:-*}"

cd "$(dirname "$0")/.."

command -v az >/dev/null || { echo "az CLI not found: https://aka.ms/azure-cli" >&2; exit 1; }
az account show >/dev/null 2>&1 || { echo "not signed in — run: az login" >&2; exit 1; }

if [[ -z "$ADMIN_SOURCE_IP" ]]; then
  ADMIN_SOURCE_IP="$(curl -fsS https://api.ipify.org || true)"
  [[ -n "$ADMIN_SOURCE_IP" ]] || { echo "could not detect your IP; set ADMIN_SOURCE_IP=" >&2; exit 1; }
  echo "restricting SSH to your current address: $ADMIN_SOURCE_IP"
fi

echo "==> resource group $RG ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" --output none

echo "==> static public IP"
az network public-ip create \
  --resource-group "$RG" --name "${VM}-ip" \
  --sku Standard --allocation-method Static --version IPv4 \
  --output none 2>/dev/null || true

if az vm show --resource-group "$RG" --name "$VM" >/dev/null 2>&1; then
  echo "==> VM $VM already exists, leaving it alone"
else
  echo "==> VM $VM ($SIZE, $DISK_GB GB)"
  tmp_init="$(mktemp)"
  sed "s/\${admin_username}/$ADMIN/g" deploy/cloud-init.yaml > "$tmp_init"

  az vm create \
    --resource-group "$RG" --name "$VM" \
    --image "$IMAGE" --size "$SIZE" \
    --admin-username "$ADMIN" \
    --generate-ssh-keys \
    --public-ip-address "${VM}-ip" \
    --os-disk-size-gb "$DISK_GB" \
    --storage-sku StandardSSD_LRS \
    --custom-data "$tmp_init" \
    --nsg-rule NONE \
    --output none
  rm -f "$tmp_init"
fi

NSG="$(az network nsg list --resource-group "$RG" --query "[0].name" -o tsv)"
echo "==> firewall rules on $NSG"

rule() {  # name priority protocol ports source
  az network nsg rule create \
    --resource-group "$RG" --nsg-name "$NSG" --name "$1" \
    --priority "$2" --protocol "$3" --destination-port-ranges $4 \
    --source-address-prefixes "$5" \
    --access Allow --direction Inbound --output none 2>/dev/null \
  || az network nsg rule update \
    --resource-group "$RG" --nsg-name "$NSG" --name "$1" \
    --priority "$2" --protocol "$3" --destination-port-ranges $4 \
    --source-address-prefixes "$5" --output none
}

rule allow-http     1001 Tcp "80"       "*"
rule allow-https    1002 Tcp "443"      "*"
rule allow-http3    1003 Udp "443"      "*"
rule allow-ssh      1004 Tcp "22"       "$ADMIN_SOURCE_IP"
if [[ "$SYSLOG_SOURCE_IPS" == "*" ]]; then
  echo "warning: syslog 514 is open to the whole internet — set SYSLOG_SOURCE_IPS to the senders' addresses" >&2
fi
rule allow-syslog-u 1005 Udp "514"      "$SYSLOG_SOURCE_IPS"
rule allow-syslog-t 1006 Tcp "514"      "$SYSLOG_SOURCE_IPS"

IP="$(az vm show -d --resource-group "$RG" --name "$VM" --query publicIps -o tsv)"

cat <<EOF

Provisioned.

  public IP   $IP
  ssh         ssh $ADMIN@$IP
  size        $SIZE in $LOCATION

Next:
  1. Claim a DuckDNS name at https://www.duckdns.org and point it at $IP
  2. Follow docs/deploy_azure.md to deploy the application

Remember to delete it when you are done — a B2ms bills by the hour:
  az group delete --name $RG --yes --no-wait
EOF
