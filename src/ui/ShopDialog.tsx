import { useEffect } from "react";
import { useVXShop } from "@verse8/platform";
import { useT } from "../i18n";
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
  const t = useT();
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
          <h2>{t("shop_title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        {!VERSE_ID && <p className="modal-note">{t("shop_offline")}</p>}

        {VERSE_ID && isLoading && <p className="modal-note">{t("shop_loading")}</p>}
        {VERSE_ID && error && <p className="modal-note error">{error}</p>}
        {VERSE_ID && !isLoading && !error && items.length === 0 && (
          <p className="modal-note">
            {t("shop_empty")} <code>{PRODUCT_ID.removeAds}</code>
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
                  {owned ? t("shop_owned") : `${item.price} VX`}
                </button>
              </li>
            );
          })}
        </ul>

        {entitlements.adsRemoved && (
          <p className="modal-note owned">{t("shop_ads_removed")}</p>
        )}
      </div>
    </div>
  );
}
