using UnityEngine;

public class CardLogic : MonoBehaviour
{
    public void PlayCardAtDropZone(Card card, DropZone zone)
    {
        switch (card.cardName)
        {
            default:
                break;
        }
    }

    public void CreateUnitAt(string unitName, DropZone zone)
    {
        GameController.game.cardDatabase.GetCard("unitName");
    }
}
