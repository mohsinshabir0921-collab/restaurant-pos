# Deletion Matrix

## Overview
Real business deletion: order must no longer contribute to dashboard/reports. Dashboard/report queries aggregate from Order/Payment collections; deleting the document naturally excludes it. No query change needed beyond hard delete.

## Order
| Dependency | Current blocker | Desired handling | Action on delete |
|---|---|---|---|
| Payment (Payment.order) | BLOCK | Must handle, not silently corrupt | Delete all Payment where order = orderId. Payment report (status=paid) will automatically exclude. Alternative audit: mark refunded then delete; we choose delete as order-scoped ledger. |
| StockMovement (referenceId = order._id) | BLOCK | MUST reverse before delete, not simply delete movement | If order.inventoryDeducted && !inventoryRestored: restore inventory via Recipe resolution (same as cancel). Then delete StockMovement where referenceId = orderId (referenceType order/order_cancellation/order_edit). Ensures no dangling refs and inventory consistent. If already restored or never deducted, just delete movements. |
| OrderEditHistory (order = orderId) | BLOCK | Safe to cascade | Delete many |
| Notification (entityId = orderId) | BLOCK | Safe to clean order-specific notifications | Delete many where entityId = orderId. Preserves unrelated notifications. |
| Table.currentOrder | BLOCK | Must clear reference | UpdateMany Table where currentOrder = orderId => currentOrder=null, status=free (or cleaning -> free). Ensures no dangling ref. |
| Customer | none (order.customer) | Keep customer, just delete order | No action (customer stays). Optionally reverse loyalty: subtract earned, restore used. |
| Dashboard/Reports | n/a | Automatically exclude deleted orders | No code change; queries already count only existing docs. Verified isPaidOrder excludes cancelled/refunded but deleted doc is gone. |
| Bulk vs Single | different rules | Same business rules | Single delete helper and bulk loop both call same internal function. |

## Customer
| Dependency | Current | Desired |
|---|---|---|
| Notification (entityId = customer._id) | implicitly NOT blocking (test asserts must not block, preserve) | Do NOT check notifications, do NOT delete notifications to make deletable. Leave notifications preserved. |
| Order (Order.customer) | BLOCK if any | Proper policy: nullify reference. UpdateMany Order where customer = id => customer=null. Preserves order history but anonymizes. |
| Payment (Payment.customer) | BLOCK if any | Proper policy: nullify reference. UpdateMany Payment where customer = id => customer=null. |
| Result | Only deletable if unreferenced | Deletable always after nullify; no blocking on orders/payments. Mixed bulk: all customers deletable (no blocked unless missing). |

## PurchaseOrder
| Status | StockMovement | Handling |
|---|---|---|
| draft | none | Delete PO directly, delete any movements (none) |
| cancelled | none | Delete PO directly |
| sent | none (not yet received) | BLOCK per single delete rule: "Can only delete draft or cancelled" -> keep blocking sent (no stock change yet but business immutable). Bulk mirrors single. |
| partially_received | StockMovement type=in referenceType=purchase_order with receivedQty | Inventory-aware: reverse receivedQty per item (deduct from InventoryItem.currentStock). If insufficient stock to reverse (would go negative), block deletion with reason. Otherwise delete StockMovements for PO, then delete PO. |
| received | same | Same reversal as partial. All receivedQty reversed. |

## WasteLog
| Status | StockMovement | Handling |
|---|---|---|
| isApproved=false | none (not yet deducted) | Delete directly, delete any movements (none) |
| isApproved=true | StockMovement type=waste deducted | Reverse: restore quantity to InventoryItem.currentStock (+qty), create or adjust stock, then delete StockMovements for wasteLog, then delete WasteLog. If deletion required per business, reversal keeps inventory consistent. Alternative could block, but spec says "if deletion is required, implement proper inventory reversal" -> we implement reversal and allow delete. For safety, allow delete after reversal. |

## Dashboard/Report Queries
All reports currently use Order / Payment aggregates without deleted filter. Hard delete suffices. Cancelled/refunded already excluded via isPaidOrder but deleted is stronger.

## Dangling Reference Cleanup
- Delete payments -> no orphan
- Delete stock movements -> no orphan (referenceId no longer points to deleted doc)
- Delete edit history -> no orphan
- Delete notifications for order -> no orphan
- Clear Table.currentOrder -> no dangling
- Nullify customer refs in orders/payments -> no dangling

## Implementation Notes
- Inventory reversal must use same Recipe/InventoryItem.adjustStock logic as existing deduct/restore to keep stock accurate.
- Reversal must happen BEFORE deleting movements/order, and must be atomic-ish per order.
- Bulk mixed selections: iterate each id, apply policy, collect deletedCount/blocked/missing. For orders: no blocked category (all deletable after reversal/cleanup). For customers: no blocked (after nullify). For PO/waste: blocked only when inventory reversal would make stock negative or status not deletable (sent for PO).
