import { useEffect } from "react";
import { useVXShop } from "@verse8/platform";
import { PRODUCT_ID, type Entitlements } from "../game/types";

const VERSE_ID = import.meta.env.VITE_AGENT8_VERSE as string | undefined;

interface Props {
  entitlements: Entitlements;
  onPurchased: () => void;
  onClose: () => void;
}

/**
 * VX Shop front. Items come from the Verse8 dashboard, not from this file —
 * `buyItem` opens the platform's own purchase dialog, and the entitlement is
 * granted by the server's $onItemPurchased handler. The client never grants
 * anything itself; it only re-reads state once the dialog closes.
 */
export function ShopDialog({ entitlements, onPurchased, onClose }: Props) {
  const { items, isLoading, error, buyItem, refresh, onClose: onShopClose } =
    useVXShop({ verseId: VERSE_ID });

  useEffect(() => {
    const unsubscribe = onShopClose((payload) => {
      if (!payload.purchased) return;
      onPurchased();
      void refresh();
    });
    return unsubscribe;
  }, [onShopClose, onPurchased, refresh]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>상점</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </header>

        {!VERSE_ID && (
          <p className="modal-note">
            아직 배포되지 않아 상점을 불러올 수 없습니다. <code>npx -y @agent8/deploy</code> 후
            Verse8 대시보드의 VX Shop 탭에서 상품을 등록해야 목록이 표시됩니다.
          </p>
        )}

        {VERSE_ID && isLoading && <p className="modal-note">상품 불러오는 중…</p>}
        {VERSE_ID && error && <p className="modal-note error">상점 오류: {error}</p>}
        {VERSE_ID && !isLoading && !error && items.length === 0 && (
          <p className="modal-note">
            등록된 상품이 없습니다. Verse8 대시보드 → 게임 관리 → VX Shop 탭에서
            상품 ID <code>{PRODUCT_ID.removeAds}</code>를 등록하고 Active로 전환하세요.
          </p>
        )}

        <ul className="shop-list">
          {items.map((item) => {
            const owned =
              item.productId === PRODUCT_ID.removeAds && entitlements.adsRemoved;
            const blocked = owned || !item.purchasable || item.purchaseLimitReached;

            return (
              <li key={item.productId} className="shop-item">
                {item.imageUrl && <img src={item.imageUrl} alt="" />}
                <div className="shop-item-body">
                  <b>{item.name}</b>
                  <p>{item.description}</p>
                  {!owned && item.purchaseBlockReason && (
                    <p className="shop-block">{item.purchaseBlockReason}</p>
                  )}
                </div>
                <button disabled={blocked} onClick={() => buyItem(item.productId)}>
                  {owned ? "보유 중" : `${item.price} VX`}
                </button>
              </li>
            );
          })}
        </ul>

        {entitlements.adsRemoved && (
          <p className="modal-note owned">광고 제거가 적용되어 있습니다.</p>
        )}
      </div>
    </div>
  );
}
