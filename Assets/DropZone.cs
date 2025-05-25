using UnityEngine;

public class DropZone : MonoBehaviour
{
    public bool isHand;
    public bool isField;
    public void HandleDrop(Card c)
    {
        if (isField)
        {
            GameController.game.AttemptToPlayCardOnDropZone(c, this);
            
        }
    }
}
