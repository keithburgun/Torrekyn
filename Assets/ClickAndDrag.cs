using UnityEngine;
using UnityEngine.EventSystems;

[RequireComponent(typeof(RectTransform))]
public class ClickAndDrag : MonoBehaviour, IDragHandler, IBeginDragHandler, IEndDragHandler
{
    public Card myCard; 
    private Vector2 _centerPoint;
    private Vector2 _worldCenterPoint => transform.TransformPoint(_centerPoint);

    private void Awake()
    {
        _centerPoint = (transform as RectTransform).rect.center;
    }

    public void OnBeginDrag(PointerEventData eventData)
    {
        GameController.game.DragCard(myCard);
    }

    public void OnDrag(PointerEventData eventData)
    {
        //if (GameController.game.IsWithinBounds(_worldCenterPoint + eventData.delta))
        //{
        myCard.transform.Translate(eventData.delta);
        //}
    }

    public void OnEndDrag(PointerEventData eventData)
    {

        GameController.game.DropCard(eventData.pointerCurrentRaycast.screenPosition); // Pass the drop zone object
    }
}
