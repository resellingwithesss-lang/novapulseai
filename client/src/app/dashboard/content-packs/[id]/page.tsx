import ContentPackDetailClient from "./ContentPackDetailClient"

export default function ContentPackDetailPage({
  params,
}: {
  params: { id: string }
}) {
  return <ContentPackDetailClient id={params.id} />
}
