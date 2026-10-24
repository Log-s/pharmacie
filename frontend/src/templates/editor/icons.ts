import { CalendarIcon, CircleDotIcon, FolderIcon, HashIcon, ListChecksIcon, TextIcon, UserIcon, type LucideIcon } from 'lucide-react'
import type { NodeType } from '@/templates/schema'

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  category: FolderIcon,
  checkbox_group: ListChecksIcon,
  radio_group: CircleDotIcon,
  date: CalendarIcon,
  author: UserIcon,
  reference: HashIcon,
  text: TextIcon,
}
export const NODE_TYPES = Object.keys(NODE_ICONS) as NodeType[]
