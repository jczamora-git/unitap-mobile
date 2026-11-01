<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronForwardOutline, folderOutline, folderOpenOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

export interface TreeNodeChild {
  id: string;
  label: string;
  badge?: string;
  badgeVariant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  meta?: string;
  [key: string]: any;
}

export interface TreeNode {
  id: string;
  label: string;
  badge?: string;
  count?: number;
  children?: TreeNodeChild[];
  isExpanded?: boolean;
  [key: string]: any;
}

interface Props {
  nodes?: TreeNode[];
  defaultExpandAll?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  nodes: () => [],
  defaultExpandAll: true,
});

const emit = defineEmits<{
  (e: 'node-toggle', nodeId: string, expanded: boolean): void;
  (e: 'select-child', child: TreeNodeChild, parent: TreeNode): void;
}>();

const expandedMap = ref<Record<string, boolean>>({});

watch(
  () => props.nodes,
  (newNodes) => {
    const map: Record<string, boolean> = { ...expandedMap.value };
    newNodes.forEach((node, index) => {
      if (map[node.id] === undefined) {
        map[node.id] = props.defaultExpandAll || index === 0;
      }
    });
    expandedMap.value = map;
  },
  { immediate: true, deep: true }
);

function toggleNode(nodeId: string) {
  haptics.light();
  expandedMap.value[nodeId] = !expandedMap.value[nodeId];
  emit('node-toggle', nodeId, expandedMap.value[nodeId]);
}

function handleChildClick(child: TreeNodeChild, parent: TreeNode) {
  haptics.light();
  emit('select-child', child, parent);
}
</script>

<template>
  <div class="uni-tree-view">
    <div
      v-for="node in nodes"
      :key="node.id"
      class="tree-node"
      :class="{ 'is-expanded': !!expandedMap[node.id] }"
    >
      <!-- Parent Header Node -->
      <div
        class="node-header"
        role="button"
        tabindex="0"
        :aria-expanded="!!expandedMap[node.id]"
        @click="toggleNode(node.id)"
        @keydown.enter.space.prevent="toggleNode(node.id)"
      >
        <div class="node-left">
          <ion-icon
            :icon="chevronForwardOutline"
            class="tree-chevron"
            :class="{ 'is-rotated': !!expandedMap[node.id] }"
          />
          <ion-icon
            :icon="expandedMap[node.id] ? folderOpenOutline : folderOutline"
            class="folder-icon"
          />
          <span class="node-label">{{ node.label }}</span>
          <span v-if="node.badge" class="node-badge">{{ node.badge }}</span>
          <span v-if="node.count !== undefined" class="node-count-pill">
            {{ node.count }}
          </span>
        </div>

        <div class="node-right" @click.stop>
          <slot name="node-actions" :node="node" />
        </div>
      </div>

      <!-- Child List with Indented Branching -->
      <div v-show="expandedMap[node.id]" class="node-children">
        <template v-if="node.children && node.children.length > 0">
          <div
            v-for="child in node.children"
            :key="child.id"
            class="tree-child-item"
            @click="handleChildClick(child, node)"
          >
            <slot name="child" :child="child" :parent="node">
              <div class="default-child-row">
                <div class="child-left">
                  <span class="child-bullet" />
                  <span class="child-label">{{ child.label }}</span>
                  <span
                    v-if="child.badge"
                    class="child-badge"
                    :class="child.badgeVariant ? `badge-${child.badgeVariant}` : 'badge-neutral'"
                  >
                    {{ child.badge }}
                  </span>
                </div>
                <div class="child-right">
                  <span v-if="child.meta" class="child-meta">{{ child.meta }}</span>
                  <slot name="child-actions" :child="child" :parent="node" />
                </div>
              </div>
            </slot>
          </div>
        </template>
        <div v-else class="tree-empty-children">
          <slot name="empty-children" :node="node">
            <span class="empty-text">No items under this group</span>
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uni-tree-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.tree-node {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 16px);
  box-shadow: var(--uni-shadow-card);
  overflow: hidden;
  transition: border-color 0.16s ease;
}

.tree-node.is-expanded {
  border-color: var(--uni-border, #cbd5e1);
}

.node-header {
  min-height: 48px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  background: var(--uni-surface-secondary, #f8fafc);
  transition: background 0.14s ease;
}

.node-header:hover {
  background: var(--uni-surface-secondary, #f1f5f9);
}

.node-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.tree-chevron {
  font-size: 14px;
  color: var(--uni-text-secondary, #64748b);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.tree-chevron.is-rotated {
  transform: rotate(90deg);
  color: var(--uni-primary, #0f766e);
}

.folder-icon {
  font-size: 16px;
  color: var(--uni-primary, #0f766e);
  flex-shrink: 0;
}

.node-label {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary, #0f766e);
  text-transform: uppercase;
}

.node-count-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #cbd5e1);
  color: var(--uni-text-secondary, #64748b);
}

.node-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.node-children {
  padding: 6px 10px 10px 22px;
  border-top: 1px solid var(--uni-border, #f1f5f9);
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

/* Vertical guide line */
.node-children::before {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 12px;
  left: 20px;
  width: 1px;
  background: var(--uni-border, #e2e8f0);
}

.tree-child-item {
  position: relative;
  border-radius: 10px;
  transition: background 0.12s ease;
}

.tree-child-item:hover {
  background: var(--uni-surface-secondary, #f8fafc);
}

.default-child-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  min-height: 40px;
  gap: 8px;
}

.child-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.child-bullet {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--uni-primary, #0f766e);
  flex-shrink: 0;
}

.child-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

.child-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 9999px;
  text-transform: uppercase;
}

.badge-neutral {
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #64748b);
  border: 1px solid var(--uni-border, #e2e8f0);
}

.badge-primary {
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary, #0f766e);
}

.badge-success {
  background: rgba(5, 150, 105, 0.1);
  color: var(--uni-success, #059669);
}

.child-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.child-meta {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748b);
}

.tree-empty-children {
  padding: 12px 14px;
}

.empty-text {
  font-size: 12px;
  font-style: italic;
  color: var(--uni-text-secondary, #94a3b8);
}

:root.dark .tree-node,
:root.ion-palette-dark .tree-node,
body.dark .tree-node,
body.ion-palette-dark .tree-node {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

:root.dark .node-header,
:root.ion-palette-dark .node-header,
body.dark .node-header,
body.ion-palette-dark .node-header {
  background: var(--uni-surface-secondary, #252830);
}

:root.dark .node-children::before,
:root.ion-palette-dark .node-children::before,
body.dark .node-children::before,
body.ion-palette-dark .node-children::before {
  background: var(--uni-border, #30343D);
}
</style>

