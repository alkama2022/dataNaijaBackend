import { PAYMENT_GATEWAYS } from '@/lib/admin/payment-gateways'
import { Flash, Note, PageHeader } from '../../_components/page-parts'
import { GatewayTable } from '../../_components/gateway-table'

/**
 * The Payment methods tab: what each gateway charges, so the admin picks
 * the cheapest way to fund the wallets.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string }
}) {
  return (
    <>
      <PageHeader
        title="Payment methods"
        subtitle="Compare gateways, their charges and websites"
        tag="Not connected"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <Note>
        This panel does not connect to a payment gateway. Fee references can
        change; confirm rates directly with providers. Estimated or
        unconfirmed rates are excluded from the cheapest-rate indicator.
      </Note>

      <GatewayTable gateways={PAYMENT_GATEWAYS} />
    </>
  )
}
