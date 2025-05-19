using UnityEngine;
using UnityEngine.InputSystem;


public class CameraController : MonoBehaviour
{
    public float zoomSpeed = 5f;
    public Camera targetCamera;
    private PlayerInput playerInputActions;

    private void Awake()
    {
        playerInputActions = new PlayerInput();
        targetCamera = GetComponent<Camera>(); // Or assign in the Inspector
    }

    /*
    private void OnEnable()
    {
        playerInputActions.Camera.Enable();
    }

    private void OnDisable()
    {
        playerInputActions.Camera.Disable();
    }
    */

    private void Update()
    {
        float scrollDelta = playerInputActions.Camera.Zoom.ReadValue<float>();

        if (targetCamera.orthographic)
        {
            targetCamera.orthographicSize -= scrollDelta * zoomSpeed;
            targetCamera.orthographicSize = Mathf.Max(0.1f, targetCamera.orthographicSize); // Optional: Clamp zoom level
        }
        else
        {
            targetCamera.fieldOfView -= scrollDelta * zoomSpeed;
            targetCamera.fieldOfView = Mathf.Clamp(targetCamera.fieldOfView, 10f, 90f); // Optional: Clamp zoom level
        }
    }
}
