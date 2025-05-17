using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class Card : MonoBehaviour, IDragHandler, IBeginDragHandler, IEndDragHandler
{
    public TextMeshProUGUI cardName;

    public GameObject glow;
    public CanvasGroup canvasGroup;

    public DropZone myLastDropZone;

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

        // Perform raycast to check for Drop Zones
        List<RaycastResult> results = new List<RaycastResult>();
        EventSystem.current.RaycastAll(eventData, results);

        GameObject dropZone = null;
        foreach (RaycastResult result in results)
        {
            DropZone dz = result.gameObject.GetComponent<DropZone>();
            if (dz != null)
            {
                dropZone = result.gameObject;
                dz.HandleDrop(this); // Pass the dragged card's GameObject
                return; // Exit after a successful drop
            }
        }

        // If no valid drop zone was hit, return the card to its original position

        if (myLastDropZone == GameController.game.ui.hand.dropZone)
        {
            GameController.game.deckManager.AddCardToHand(this);
            GameController.game.ui.hand.PlaceCardInHand(this);
            Debug.Log("placing card back in hand...");
        }

        canvasGroup.blocksRaycasts = true; // Re-enable raycasts on the card

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
