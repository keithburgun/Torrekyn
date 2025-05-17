using UnityEngine;

public class DropZone : MonoBehaviour
{
    public bool isHand;
    public bool isField;
    public void HandleDrop(Card c)
    {
        if (isHand)
        {
            GameController.game.deckManager.AddCardToHand(c);
        }
        if (isField)
        {
            // add card to field.
        }
    }
}
