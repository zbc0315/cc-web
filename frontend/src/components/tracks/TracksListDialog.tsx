// frontend/src/components/tracks/TracksListDialog.tsx
import { TrackFlowsListDialog } from './flow/TrackFlowsListDialog'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TracksListDialog(props: Props) {
  return <TrackFlowsListDialog {...props} />
}
