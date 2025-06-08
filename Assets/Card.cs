using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class Card : MonoBehaviour, IDragHandler, IBeginDragHandler, IEndDragHandler
{
    public TextMeshProUGUI cardName;

    public GameObject glow;
    public CanvasGroup canvasGroup;

    public DropZone myLastDropZone;

    public LayerMask worldDropZoneLayer;

    public CardData myCardData;

    public void Select()
    {
        glow.SetActive(true);
    }

    public void Deselect()
    {
        glow.SetActive(false);
    }

    public void Populate(CardData newCardData)
    {
        myCardData = newCardData;
        cardName.text = newCardData.properName;
    }

    public void SetSizeForHand()
    {
        transform.localScale = new Vector2(Configuration.playmodeCardScale, Configuration.playmodeCardScale);

    }

    public void SetSizeInspect()
    {
        transform.localScale = new Vector2(Configuration.playmodeHoverCardScale, Configuration.playmodeHoverCardScale);

    }

    public void SetSizeFull()
    {
        transform.localScale = new Vector2(1, 1);
    }

    public void Drop(PointerEventData eventData)
    {
        // Get the GameObject that was actually being dragged.
        // If this script is on the card itself, eventData.pointerDrag will be this.gameObject.
        GameObject droppedObject = this.gameObject; // 'this' refers to the GameObject this script is on

        if (droppedObject == null)
        {
            Debug.LogWarning("OnDrop: No object was being dragged. Exiting.");
            if (canvasGroup != null) canvasGroup.blocksRaycasts = true;
            return;
        }

        bool dropHandledByZone = false; // Flag to track if any DropZone handled the drop

        // --- 1. Check for UI DropZones (on the Canvas layer) ---
        List<RaycastResult> uiRaycastResults = new List<RaycastResult>();
        EventSystem.current.RaycastAll(eventData, uiRaycastResults);

        foreach (RaycastResult result in uiRaycastResults)
        {
            DropZone dropZone = result.gameObject.GetComponent<DropZone>();

            if (dropZone != null)
            {
                Debug.Log($"Card '{name}' dropped over UI DropZone: {result.gameObject.name}");
                GameController.game.AttemptToPlayCardOnDropZone(this, dropZone);
                dropHandledByZone = true;
                myLastDropZone = dropZone; // Update last drop zone if it's a valid one
                break; // Assuming only one UI DropZone should handle the drop
            }
        }

        // If a UI DropZone already handled it, we can stop here.
        if (dropHandledByZone)
        {
            if (canvasGroup != null) canvasGroup.blocksRaycasts = true; // Re-enable raycasts
            return;
        }

        // --- 2. Check for World Space DropZones (using Physics2D) ---
        if (Camera.main != null)
        {
            // Convert the UI pointer position to a world point
            // This is crucial for checking against world colliders
            Vector2 worldPointerPosition = Camera.main.ScreenToWorldPoint(eventData.position);

            Debug.Log($"Checking world position: {worldPointerPosition}");

            // Use a specific layer mask to only check relevant colliders
            Collider2D[] hitColliders = Physics2D.OverlapPointAll(worldPointerPosition, worldDropZoneLayer);

            foreach (Collider2D hitCollider in hitColliders)
            {
                DropZone dropZone = hitCollider.gameObject.GetComponent<DropZone>();

                if (dropZone != null)
                {
                    if (dropZone.isHand)
                    {
                        GameController.game.ReturnCardToHand(this);
                        break;
                    }
                    else
                    {
                        Debug.Log($"Card '{name}' dropped into World DropZone: {hitCollider.gameObject.name}");
                        GameController.game.AttemptToPlayCardOnDropZone(this, dropZone);
                        dropHandledByZone = true;
                        myLastDropZone = dropZone; // Update last drop zone
                        break; // Assuming only one world DropZone should handle the drop
                    }
                }
            }
        }
        else
        {
            Debug.LogWarning("Main Camera not assigned or found. Cannot perform world-space drop zone check.");
        }


        // If no valid drop zone (either UI or World) was hit, return the card to its original position
        if (!dropHandledByZone)
        {
            if (myLastDropZone == GameController.game.ui.hand.dropZone)
            {
                GameController.game.ReturnCardToHand(this);
            }
            else
            {
                Debug.Log($"Card '{droppedObject.name}' dropped, but no valid DropZone was hit. No specific return to hand logic for non-hand drop zones.");
                // Optionally revert position to original drag start position if desired
                // if (rectTransform != null) rectTransform.position = originalPosition;
            }
        }

        if (canvasGroup != null)
        {
            canvasGroup.blocksRaycasts = true; // Re-enable raycasts on the card
        }
    }


    // EVENT HANDLERS:

    public void OnBeginDrag(PointerEventData eventData)
    {
        GameController.game.ui.hand.dropZone.GetComponent<Image>().raycastTarget = true; // ENABLE dropping.
        canvasGroup.blocksRaycasts = false; 
        GameController.game.DragCard(this);
    }

    public void OnDrag(PointerEventData eventData)
    {
        transform.Translate(eventData.delta); // moves iwth the mouse cursor.
    }

    public void OnEndDrag(PointerEventData eventData)
    {

        Drop(eventData);
        GameController.game.ui.hand.dropZone.GetComponent<Image>().raycastTarget = false; // DISABLE dropping.

    }
}
